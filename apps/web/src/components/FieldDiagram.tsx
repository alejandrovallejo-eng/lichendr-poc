export default function FieldDiagram() {
  return (
    <figure className="ld-field-diagram">
      <svg
        viewBox="0 0 300 300"
        role="img"
        aria-labelledby="field-diagram-title"
      >
        <title id="field-diagram-title">
          Cuatro vistas del mismo tronco: norte, este, sur y oeste
        </title>
        <circle
          cx="150"
          cy="150"
          r="107"
          fill="none"
          stroke="#729287"
          strokeDasharray="3 6"
        />
        <path
          d="M150 38v60 M150 202v60 M38 150h60 M202 150h60"
          stroke="#a8c5b8"
        />
        <circle
          cx="150"
          cy="150"
          r="58"
          fill="#315c4d"
          stroke="#a8c5b8"
          strokeWidth="2"
        />
        <path
          d="M130 98c-8 19 5 27-2 46s-10 36 0 58 M149 94c9 20-10 36 2 56s-8 37 0 55 M174 99c-7 19 7 39-3 51s6 35 1 53"
          fill="none"
          stroke="#749789"
          strokeWidth="2"
        />
        <path
          d="M139 127c-14-11-27 4-19 14-11 7-1 24 11 19 10 11 26 0 19-11 11-7 2-25-11-22Z M170 166c-12-8-24 4-17 13-8 11 8 20 17 13 15 6 21-12 10-18 3-7-4-12-10-8Z"
          fill="#cfda93"
          stroke="#e1e8bb"
        />
        {(
          [
            ["N", 150, 24],
            ["E", 278, 155],
            ["S", 150, 287],
            ["O", 22, 155],
          ] as const
        ).map(([label, x, y]) => (
          <text
            key={label}
            x={x}
            y={y}
            fill="#eff5ef"
            textAnchor="middle"
            fontSize="17"
            fontWeight="600"
          >
            {label}
          </text>
        ))}
        <g fill="#dae6df" stroke="#dae6df">
          <rect x="136" y="40" width="28" height="18" rx="4" />
          <rect x="136" y="242" width="28" height="18" rx="4" />
          <rect x="40" y="136" width="18" height="28" rx="4" />
          <rect x="242" y="136" width="18" height="28" rx="4" />
        </g>
        <g fill="#173d35">
          <circle cx="150" cy="49" r="5" />
          <circle cx="150" cy="251" r="5" />
          <circle cx="49" cy="150" r="5" />
          <circle cx="251" cy="150" r="5" />
        </g>
      </svg>
      <figcaption>
        Un árbol. Cuatro orientaciones.
        <br />
        Un registro comparable.
      </figcaption>
    </figure>
  );
}
