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

VISION_PID=""
NEXTJS_PID=""
REUSE_VISION=false
REUSE_NEXTJS=false

listener_pids() {
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u
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
    [ -n "${addresses}" ] || return 1
    while IFS= read -r address; do
        [[ "${address}" == 127.0.0.1:* || "${address}" == "[::1]":* ]] || return 1
    done <<< "${addresses}"
}

vision_service_is_healthy() {
    local health
    health="$(curl -fsS --max-time 3 "http://${VISION_HOST}:${VISION_PORT}/health" 2>/dev/null || true)"
    [[ "${health}" =~ \"status\"[[:space:]]*:[[:space:]]*\"ok\" ]] \
        && [[ "${health}" =~ \"model\"[[:space:]]*:[[:space:]]*\"MobileSAM[[:space:]]vit_t\" ]]
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
    [ -n "${pid}" ] || return 0
    pkill -TERM -P "${pid}" 2>/dev/null || true
    kill "${pid}" 2>/dev/null || true
}

cleanup() {
    if [ -z "${VISION_PID}" ] && [ -z "${NEXTJS_PID}" ]; then
        return
    fi
    echo ""
    echo "Shutting down services started by this script …"
    stop_owned_process "${VISION_PID}"
    stop_owned_process "${NEXTJS_PID}"
    wait 2>/dev/null || true
    echo "Done."
}

wait_for_frontend() {
    echo -n "Waiting for Next.js …"
    for i in $(seq 1 60); do
        if listener_pids "${NEXTJS_PORT}" >/dev/null 2>&1; then
            echo " ready."
            return
        fi
        if ! kill -0 "${NEXTJS_PID}" 2>/dev/null; then
            echo " FAILED — Next.js exited before listening." >&2
            return 1
        fi
        if [ "${i}" -eq 60 ]; then
            echo " TIMEOUT — Next.js did not listen in 60 s." >&2
            return 1
        fi
        echo -n "."
        sleep 1
    done
}

wait_for_vision() {
    echo -n "Waiting for Vision Service …"
    for i in $(seq 1 60); do
        if vision_service_is_healthy; then
            echo " ready."
            return
        fi
        if ! kill -0 "${VISION_PID}" 2>/dev/null; then
            echo " FAILED — Vision Service exited before becoming healthy." >&2
            return 1
        fi
        if [ "${i}" -eq 60 ]; then
            echo " TIMEOUT — Vision Service did not start in 60 s." >&2
            return 1
        fi
        echo -n "."
        sleep 1
    done
}

main() {
    trap cleanup INT TERM EXIT

    # Check every listener before starting either service. A frontend conflict
    # must never cause a subsequently started healthy vision process to be killed.
    preflight_listeners

    if [ "${REUSE_NEXTJS}" = false ]; then
        echo "Starting Next.js on 0.0.0.0:${NEXTJS_PORT} …"
        (
            cd "${WEB_DIR}"
            exec npm run dev -- --hostname 0.0.0.0 --port "${NEXTJS_PORT}"
        ) &
        NEXTJS_PID=$!
        wait_for_frontend
    fi

    if [ "${REUSE_VISION}" = false ]; then
        if [ ! -f "${VENV_DIR}/bin/uvicorn" ]; then
            echo "Vision service not set up. Running setup …"
            bash "${SCRIPT_DIR}/setup-vision-service.sh"
        fi
        echo "Starting Vision Service on ${VISION_HOST}:${VISION_PORT} …"
        "${VENV_DIR}/bin/uvicorn" app:app \
            --host "${VISION_HOST}" \
            --port "${VISION_PORT}" \
            --app-dir "${SERVICE_DIR}" \
            --workers 1 \
            --log-level info &
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

    if [ -n "${NEXTJS_PID}" ]; then
        wait "${NEXTJS_PID}"
    elif [ -n "${VISION_PID}" ]; then
        wait "${VISION_PID}"
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
