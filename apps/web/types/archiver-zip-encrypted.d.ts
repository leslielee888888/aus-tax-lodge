/**
 * Minimal type shim for `archiver-zip-encrypted` (v2), which ships no types.
 *
 * The package is only ever used as the module argument to
 * `archiver.registerFormat("zip-encrypted", require("archiver-zip-encrypted"))`;
 * `archiver.create("zip-encrypted", { encryptionMethod, password, zlib })` then
 * returns a normal `archiver.Archiver`. See `lib/export/archive.ts`.
 */
declare module "archiver-zip-encrypted" {
  const format: unknown;
  export default format;
}
