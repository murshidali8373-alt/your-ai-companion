declare module "mammoth" {
  export interface MammothMessage {
    type: string;
    message: string;
  }
  export interface MammothResult<T = string> {
    value: T;
    messages: MammothMessage[];
  }
  export function extractRawText(
    input: { buffer: Buffer } | { arrayBuffer: ArrayBuffer },
  ): Promise<MammothResult<string>>;
  export function convertToHtml(
    input: { buffer: Buffer } | { arrayBuffer: ArrayBuffer },
  ): Promise<MammothResult<string>>;
}
