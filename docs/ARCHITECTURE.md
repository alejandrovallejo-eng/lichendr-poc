Arquitectura

La aplicación se organiza en módulos dentro de `apps/web/src/modules`.

Jerarquía de entidades:

- `Project` → contiene `Site` → contiene `SamplingEvent` → contiene `TreeSample` → contiene `ImageRecord` y `AnnotationSet`.

Los módulos principales:
- `projects`, `sites`, `sampling-events`, `trees`, `images`, `annotations`, `analysis`, `environmental-quality`, `exports`.

Cada módulo expone la UI para listar, crear y vincular las entidades correspondientes.
