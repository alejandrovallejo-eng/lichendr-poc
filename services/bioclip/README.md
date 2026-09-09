# Worker BioCLIP 2 local (piloto)

Worker **local** y aislado que sugiere una de tres etiquetas (`lichen`, `moss`,
`bare tree bark`) para los recortes de las regiones que propone MobileSAM.

- Desactivado salvo `BIOCLIP_WORKER_ENABLED=1`.
- Dependencias fijadas en `requirements.txt`. **No** se añaden PyTorch ni BioCLIP
  al servicio ONNX de 512 MB (`services/vision`): el pico real observado es de
  ~3–3.3 GiB.
- Modelo cargado una sola vez, **concurrencia 1 real** (el semáforo se libera
  cuando la inferencia termina de verdad, no cuando expira el plazo de quien
  espera), cola acotada y plazo que incluye la espera en cola.
- Admisión **antes** de decodificar, tamaño acotado por los bytes realmente
  recibidos (no solo por `Content-Length`), topes agregados de bytes y píxeles
  alineados con la ruta web, y microlotes en el encoder.
- Una cabeza NPZ configurada que no valida devuelve `503 head_invalid`: nunca
  degrada en silencio a *zero-shot*.
- No abre túneles ni se publica. **Dónde se alojará es una decisión pendiente**:
  aquí no se contrata ni se despliega nada.
- Las puntuaciones son crudas, no probabilidades; toda sugerencia queda
  `pending` hasta que una persona la revise.

Descarga verificada del encoder, cabeza NPZ opcional, smoke CLI real, comandos
exactos y limitaciones: ver [`docs/BIOCLIP_PILOT.md`](../../docs/BIOCLIP_PILOT.md).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python download_model.py --dest ./models/bioclip-2
BIOCLIP_WORKER_ENABLED=1 BIOCLIP_MODEL_DIR=./models/bioclip-2 \
  python -m uvicorn app:app --host 127.0.0.1 --port 8500
python -m pytest tests -q
```
