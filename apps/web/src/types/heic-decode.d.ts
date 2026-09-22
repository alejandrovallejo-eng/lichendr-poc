declare module "heic-decode" {
  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  interface DeferredImage {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  }

  interface DeferredImages extends Array<DeferredImage> {
    dispose(): void;
  }

  interface HeicDecoder {
    (input: { buffer: Uint8Array }): Promise<DecodedImage>;
    all(input: { buffer: Uint8Array }): Promise<DeferredImages>;
  }

  const decode: HeicDecoder;
  export default decode;
}
