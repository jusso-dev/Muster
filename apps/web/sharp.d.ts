declare module "sharp" {
  export interface Metadata {
    format?: string;
    mediaType?: string;
    width?: number;
    height?: number;
    pages?: number;
    pageHeight?: number;
    autoOrient?: { width: number; height: number };
  }

  export interface Sharp {
    metadata(): Promise<Metadata>;
    png(): Sharp;
    toBuffer(): Promise<Buffer>;
  }

  export type SharpInput =
    | Uint8Array
    | Buffer
    | {
        create: {
          width: number;
          height: number;
          channels: 3 | 4;
          background: {
            r: number;
            g: number;
            b: number;
            alpha?: number;
          };
        };
      };

  export type SharpOptions = {
    animated?: boolean;
    failOn?: "none" | "truncated" | "error" | "warning";
    limitInputPixels?: number | boolean;
  };

  export default function sharp(
    input?: SharpInput,
    options?: SharpOptions,
  ): Sharp;
}
