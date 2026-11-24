// @effect-diagnostics nodeBuiltinImport:off - ffi-rs resolves only through require in the single-executable server.
import * as NodeModule from "node:module";
import * as Schema from "effect/Schema";

// A single-executable server resolves packages on disk only through `require`.
const requireExternal = NodeModule.createRequire(import.meta.url);

/** Prefix of a secret sealed with DPAPI; anything else on disk is a legacy plaintext secret. */
export const DPAPI_SEALED_PREFIX = Buffer.from("T3DPAPI\u0001", "latin1");
const ENTROPY = Buffer.from("t3code-server-secret-store");
const CRYPTPROTECT_UI_FORBIDDEN = 0x1;

/** DPAPI itself refused the data: it was sealed for another account or machine, or is damaged. */
export class DpapiRejectedError extends Schema.TaggedError<DpapiRejectedError>()(
  "DpapiRejectedError",
  { message: Schema.String },
) {}

/**
 * Seals or opens bytes with Windows DPAPI for the current user: only this Windows account on this
 * machine can open them, so a copied or backed-up file is useless elsewhere. 64-bit Windows only.
 */
function dpapi(
  operation: "CryptProtectData" | "CryptUnprotectData",
  input: Uint8Array,
): Uint8Array {
  const { DataType, load, open } = requireExternal("ffi-rs") as typeof import("ffi-rs");
  open({ library: "t3-crypt32", path: "crypt32.dll" });
  open({ library: "t3-kernel32", path: "kernel32.dll" });
  const kernel32 = <T>(
    funcName: string,
    retType: unknown,
    paramsType: unknown[],
    paramsValue: unknown[],
  ) => load({ library: "t3-kernel32", funcName, retType, paramsType, paramsValue } as never) as T;
  const allocated: bigint[] = [];
  // DATA_BLOB is a DWORD size and, after padding, a 64-bit pointer.
  const blobOf = (bytes: Uint8Array) => {
    const pointer = kernel32<bigint>(
      "LocalAlloc",
      DataType.BigInt,
      [DataType.U32, DataType.BigInt],
      [0, BigInt(Math.max(bytes.length, 1))],
    );
    if (pointer === 0n) throw new Error("LocalAlloc failed");
    allocated.push(pointer);
    kernel32<void>(
      "RtlMoveMemory",
      DataType.Void,
      [DataType.BigInt, DataType.U8Array, DataType.BigInt],
      [pointer, Buffer.from(bytes), BigInt(bytes.length)],
    );
    const blob = Buffer.alloc(16);
    blob.writeUInt32LE(bytes.length, 0);
    blob.writeBigUInt64LE(pointer, 8);
    return blob;
  };
  const free = (pointer: bigint) =>
    kernel32<bigint>("LocalFree", DataType.BigInt, [DataType.BigInt], [pointer]);
  try {
    const output = Buffer.alloc(16);
    const result = load({
      library: "t3-crypt32",
      funcName: operation,
      retType: DataType.I32,
      paramsType: [
        DataType.U8Array,
        DataType.BigInt,
        DataType.U8Array,
        DataType.BigInt,
        DataType.BigInt,
        DataType.U32,
        DataType.U8Array,
      ],
      paramsValue: [blobOf(input), 0n, blobOf(ENTROPY), 0n, 0n, CRYPTPROTECT_UI_FORBIDDEN, output],
      errno: true as const,
    });
    if (result.value === 0) {
      throw new DpapiRejectedError({
        message: `${operation} failed with Windows error ${result.errnoCode}`,
      });
    }
    const size = output.readUInt32LE(0);
    const pointer = output.readBigUInt64LE(8);
    try {
      const bytes = Buffer.alloc(size);
      if (size > 0) {
        kernel32<void>(
          "RtlMoveMemory",
          DataType.Void,
          [DataType.U8Array, DataType.BigInt, DataType.BigInt],
          [bytes, pointer, BigInt(size)],
        );
      }
      return Uint8Array.from(bytes);
    } finally {
      free(pointer);
    }
  } finally {
    for (const pointer of allocated) free(pointer);
  }
}

export function isDpapiSealed(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > DPAPI_SEALED_PREFIX.length &&
    Buffer.from(bytes.subarray(0, DPAPI_SEALED_PREFIX.length)).equals(DPAPI_SEALED_PREFIX)
  );
}

export function sealWithDpapi(plain: Uint8Array): Uint8Array {
  return Buffer.concat([DPAPI_SEALED_PREFIX, dpapi("CryptProtectData", plain)]);
}

export function openWithDpapi(sealed: Uint8Array): Uint8Array {
  return dpapi("CryptUnprotectData", sealed.subarray(DPAPI_SEALED_PREFIX.length));
}
