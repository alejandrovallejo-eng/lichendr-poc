export interface SimilarColorComponent {
  id: number;
  areaPixels: number;
}

export type ColorWorkerRequest =
  | {
      type: "configure";
      width: number;
      height: number;
      rgba: ArrayBuffer;
      scopeMask: ArrayBuffer;
    }
  | {
      type: "select";
      requestId: number;
      sampleRgb: [number, number, number];
      toleranceDeltaE: number;
      minimumArea: number;
    }
  | {
      type: "components";
      requestId: number;
      excludedComponentIds: number[];
    }
  | {
      type: "cancel";
      requestId: number;
    };

export type ColorWorkerResponse =
  | {
      type: "result";
      requestId: number;
      mask: ArrayBuffer;
      components: SimilarColorComponent[];
    }
  | {
      type: "error";
      requestId: number;
      message: string;
    };
