#!/usr/bin/env bash
# dev-with-vision.sh — start Vision Service and Next.js together
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_DIR="${REPO_ROOT}/services/vision"
VENV_DIR="${SERVICE_DIR}/.venv"
WEB_DIR="${REPO_ROOT}/apps/web"
VISION_HOST="127.0.0.1"
VISION_PORT="${VISION_PORT:-8000}"
NEXTJS_PORT="${NEXTJS_PORT:-3000}"
VISION_STARTUP_TIMEOUT="${VISION_STARTUP_TIMEOUT:-180}"
VISION_STARTUP_GRACE="${VISION_STARTUP_GRACE:-15}"
NEXTJS_STARTUP_TIMEOUT="${NEXTJS_STARTUP_TIMEOUT:-60}"
SERVICE_WAIT_INTERVAL="${SERVICE_WAIT_INTERVAL:-1}"

if ! [[ "${VISION_STARTUP_TIMEOUT}" =~ ^[0-9]+$ ]] || [ "${VISION_STARTUP_TIMEOUT}" -lt 180 ]; then
    echo "VISION_STARTUP_TIMEOUT must be an integer of at least 180 seconds." >&2
    exit 2
fi

VISION_PID=""
NEXTJS_PID=""
VISION_PROCESS_GROUP=""
NEXTJS_PROCESS_GROUP=""
REUSE_VISION=false
REUSE_NEXTJS=false

listener_pids() {
    local port="$1"
    local pids
    pids="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [ -z "${pids}" ] && command -v ss >/dev/null 2>&1; then
        pids="$(ss -H -ltnp "sport = :${port}" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p')"
    fi
    printf '%s\n' "${pids}" | sed '/^$/d' | sort -u
}

process_working_directory() {
    local pid="$1"
    local cwd=""
    if [ -e "/proc/${pid}/cwd" ]; then
        cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    fi
    if [ -z "${cwd}" ]; then
        cwd="$(lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    fi
    printf '%s' "${cwd}"
}

process_command() {
    local pid="$1"
    if [ -r "/proc/${pid}/cmdline" ]; then
        tr '\0' ' ' < "/proc/${pid}/cmdline"
    else
        ps -p "${pid}" -o command= 2>/dev/null || true
    fi
}

is_repository_nextjs() {
    local pid="$1"
    local cwd
    local command
    cwd="$(process_working_directory "${pid}")"
    command="$(process_command "${pid}")"
    [[ "${cwd}" == "${WEB_DIR}" || "${cwd}" == "${WEB_DIR}/"* ]] \
        && [[ "${command}" == *"next-server"* || "${command}" == *"/next "* || "${command}" == *"node_modules/.bin/next"* ]]
}

vision_listener_is_local() {
    local pid="$1"
    local addresses
    addresses="$(lsof -nP -a -p "${pid}" -iTCP:"${VISION_PORT}" -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n//p')"
    if [ -z "${addresses}" ] && command -v ss >/dev/null 2>&1; then
        addresses="$(ss -H -ltnp "sport = :${VISION_PORT}" 2>/dev/null \
            | grep "pid=${pid}," \
            | awk '{print $4}')"
    fi
    [ -n "${addresses}" ] || return 1
    while IFS= read -r address; do
        [[ "${address}" == 127.0.0.1:* || "${address}" == "[::1]":* ]] || return 1
    done <<< "${addresses}"
}

vision_service_is_healthy() {
    local health
    health="$(curl -fsS --max-time 3 "http://${VISION_HOST}:${VISION_PORT}/health" 2>/dev/null || true)"
    [[ "${health}" =~ \"status\"[[:space:]]*:[[:space:]]*\"ok\" ]] \
        && [[ "${health}" =~ \"model_loaded\"[[:space:]]*:[[:space:]]*true ]] \
        && [[ "${health}" =~ \"model\"[[:space:]]*:[[:space:]]*\"MobileSAM[[:space:]]vit_t\" ]]
}

frontend_service_is_healthy() {
    local status
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${NEXTJS_PORT}/" 2>/dev/null || true)"
    [[ "${status}" =~ ^(2|3)[0-9][0-9]$ ]]
}

preflight_listeners() {
    local frontend_pids
    local vision_pids
    frontend_pids="$(listener_pids "${NEXTJS_PORT}" || true)"
    if [ -n "${frontend_pids}" ]; then
        while IFS= read -r pid; do
            if ! is_repository_nextjs "${pid}"; then
                echo "ERROR: Port ${NEXTJS_PORT} belongs to another process (PID ${pid}). It was not stopped." >&2
                return 1
            fi
        done <<< "${frontend_pids}"
        if ! frontend_service_is_healthy; then
            echo "ERROR: This repository's Next.js listener on port ${NEXTJS_PORT} is not healthy. It was not stopped." >&2
            return 1
        fi
        REUSE_NEXTJS=true
        echo "Reusing this repository's Next.js listener on port ${NEXTJS_PORT}."
    fi

    vision_pids="$(listener_pids "${VISION_PORT}" || true)"
    if [ -n "${vision_pids}" ]; then
        while IFS= read -r pid; do
            if ! vision_listener_is_local "${pid}"; then
                echo "ERROR: Port ${VISION_PORT} is not a loopback-only vision listener. It was not stopped." >&2
                return 1
            fi
        done <<< "${vision_pids}"
        if ! vision_service_is_healthy; then
            echo "ERROR: Port ${VISION_PORT} is occupied by an unknown or unhealthy service. It was not stopped." >&2
            return 1
        fi
        REUSE_VISION=true
        echo "Reusing the healthy Vision Service on ${VISION_HOST}:${VISION_PORT}."
    fi
}

stop_owned_process() {
    local pid="$1"
    local process_group="$2"
    local child
    [ -n "${pid}" ] || return 0
    if [ -n "${process_group}" ]; then
        kill -TERM -- "-${process_group}" 2>/dev/null || true
        return
    fi
    if command -v pgrep >/dev/null 2>&1; then
        while IFS= read -r child; do
            [ -n "${child}" ] && stop_owned_process "${child}" ""
        done < <(pgrep -P "${pid}" 2>/dev/null || true)
    fi
    kill "${pid}" 2>/dev/null || true
}

cleanup() {
    if [ -z "${VISION_PID}" ] && [ -z "${NEXTJS_PID}" ]; then
        return
    fi
    echo ""
    echo "Shutting down services started by this script …"
    stop_owned_process "${VISION_PID}" "${VISION_PROCESS_GROUP}"
    stop_owned_process "${NEXTJS_PID}" "${NEXTJS_PROCESS_GROUP}"
    wait 2>/dev/null || true
    echo "Done."
}

wait_for_frontend() {
    echo -n "Waiting for Next.js …"
    for i in $(seq 1 "${NEXTJS_STARTUP_TIMEOUT}"); do
        if frontend_service_is_healthy; then
            echo " ready."
            return
        fi
        if ! kill -0 "${NEXTJS_PID}" 2>/dev/null; then
            echo " FAILED — Next.js exited before listening." >&2
            return 1
        fi
        if [ "${i}" -eq "${NEXTJS_STARTUP_TIMEOUT}" ]; then
            echo " TIMEOUT — Next.js was not healthy in ${NEXTJS_STARTUP_TIMEOUT} s." >&2
            return 1
        fi
        echo -n "."
        sleep "${SERVICE_WAIT_INTERVAL}"
    done
}

wait_for_vision() {
    echo -n "Waiting for Vision Service …"
    for i in $(seq 1 "${VISION_STARTUP_TIMEOUT}"); do
        if vision_service_is_healthy; then
            echo " ready."
            return
        fi
        if ! kill -0 "${VISION_PID}" 2>/dev/null; then
            echo " FAILED — Vision Service exited before becoming healthy." >&2
            return 1
        fi
        echo -n "."
        sleep "${SERVICE_WAIT_INTERVAL}"
    done
    echo ""
    echo -n "Vision is still loading after ${VISION_STARTUP_TIMEOUT} s; allowing ${VISION_STARTUP_GRACE} s grace …"
    for _ in $(seq 1 "${VISION_STARTUP_GRACE}"); do
        if vision_service_is_healthy; then
            echo " ready."
            return
        fi
        if ! kill -0 "${VISION_PID}" 2>/dev/null; then
            echo " FAILED — Vision Service exited during startup grace." >&2
            return 1
        fi
        echo -n "."
        sleep "${SERVICE_WAIT_INTERVAL}"
    done
    echo " TIMEOUT — Vision Service was not healthy after $((VISION_STARTUP_TIMEOUT + VISION_STARTUP_GRACE)) s." >&2
    echo "PID ${VISION_PID}; listener(s): $(listener_pids "${VISION_PORT}" | paste -sd, - || echo none)" >&2
    echo "Command: $(process_command "${VISION_PID}")" >&2
    return 1
}

main() {
    trap cleanup INT TERM EXIT

    # Check every listener before starting either service. A frontend conflict
    # must never cause a subsequently started healthy vision process to be killed.
    preflight_listeners

    if [ "${REUSE_NEXTJS}" = false ]; then
        echo "Starting Next.js on 0.0.0.0:${NEXTJS_PORT} …"
        if command -v setsid >/dev/null 2>&1; then
            setsid bash -c 'cd "$1"; exec npm run dev -- --hostname 0.0.0.0 --port "$2"' \
                bash "${WEB_DIR}" "${NEXTJS_PORT}" &
            NEXTJS_PROCESS_GROUP=$!
        else
            (
                cd "${WEB_DIR}"
                exec npm run dev -- --hostname 0.0.0.0 --port "${NEXTJS_PORT}"
            ) &
        fi
        NEXTJS_PID=$!
        wait_for_frontend
    fi

    if [ "${REUSE_VISION}" = false ]; then
        if [ ! -f "${VENV_DIR}/bin/uvicorn" ]; then
            echo "Vision service not set up. Running setup …"
            bash "${SCRIPT_DIR}/setup-vision-service.sh"
        fi
        echo "Starting Vision Service on ${VISION_HOST}:${VISION_PORT} …"
        if command -v setsid >/dev/null 2>&1; then
            setsid "${VENV_DIR}/bin/uvicorn" app:app \
                --host "${VISION_HOST}" \
                --port "${VISION_PORT}" \
                --app-dir "${SERVICE_DIR}" \
                --workers 1 \
                --log-level info &
            VISION_PROCESS_GROUP=$!
        else
            "${VENV_DIR}/bin/uvicorn" app:app \
                --host "${VISION_HOST}" \
                --port "${VISION_PORT}" \
                --app-dir "${SERVICE_DIR}" \
                --workers 1 \
                --log-level info &
        fi
        VISION_PID=$!
        wait_for_vision
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Open your browser at:  http://localhost:${NEXTJS_PORT}"
    echo "  Vision service listens ONLY on ${VISION_HOST}:${VISION_PORT}"
    echo "  Do NOT expose port ${VISION_PORT} publicly."
    echo "═══════════════════════════════════════════════════════"
    echo ""

    if [ -n "${NEXTJS_PID}" ] && [ -n "${VISION_PID}" ]; then
        wait -n "${NEXTJS_PID}" "${VISION_PID}"
    elif [ -n "${NEXTJS_PID}" ]; then
        wait "${NEXTJS_PID}"
    elif [ -n "${VISION_PID}" ]; then
        wait "${VISION_PID}"
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
