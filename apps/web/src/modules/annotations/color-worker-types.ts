export interface SimilarColorComponent {
  id: number;
  areaPixels: number;
  centroidX: number;
  centroidY: number;
}

export interface ColorPaletteCandidate {
  id: number;
  rgb: [number, number, number];
  percentage: number;
  centroidX: number;
  centroidY: number;
}

export type ColorAnalysisStage =
  | "comparing-colors"
  | "grouping-regions"
  | "preparing-results";

export type ColorWorkerRequest =
  | {
      type: "configure";
      requestId: number;
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
      type: "palette";
      requestId: number;
      maximumColors: number;
      minimumPercentage: number;
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
      type: "progress";
      requestId: number;
      stage: ColorAnalysisStage;
    }
  | {
      type: "result";
      requestId: number;
      mask: ArrayBuffer;
      components: SimilarColorComponent[];
    }
  | {
      type: "palette";
      requestId: number;
      candidates: ColorPaletteCandidate[];
    }
  | {
      type: "error";
      requestId: number;
      code: "invalid-input" | "not-configured" | "processing-failed";
      message: string;
      recoverable: true;
    };
