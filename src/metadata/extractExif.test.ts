import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { extractExif } from "./extractExif"

const EXIF_JPEG_BASE64 =
  "/9j/4QMiRXhpZgAATU0AKgAAAAgACQEPAAIAAAAGAAAAegEQAAIAAAAWAAAAgAESAAMAAAABAAEAAAEaAAUAAAABAAAAlgEbAAUAAAABAAAAngEoAAMAAAABAAIAAAEyAAIAAAAUAAAApgITAAMAAAABAAEAAIdpAAQAAAABAAAAugAAAABDYW5vbgBDYW5vbiBFT1MgNUQgTWFyayBJSUkAAAAASAAAAAEAAABIAAAAATIwMjU6MDU6MDYgMTU6MDY6MTUAACOCmgAFAAAAAQAAAmSCnQAFAAAAAQAAAmyIIgADAAAAAQADAACIJwADAAAAAQMgAACIMAADAAAAAQACAACIMgAEAAAAAQAAAyCQAAAHAAAABDAyMzCQAwACAAAAFAAAAnSQBAACAAAAFAAAAoiRAQAHAAAABAECAwCSAQAKAAAAAQAAApySAgAFAAAAAQAAAqSSBAAKAAAAAQAAAqySBQAFAAAAAQAAArSSBwADAAAAAQAGAACSCQADAAAAAQAQAACSCgAFAAAAAQAAArySkAACAAAAAzAwAACSkQACAAAAAzAwAACSkgACAAAAAzAwAACgAAAHAAAABDAxMDCgAQADAAAAAQABAACgAgAEAAAAAQAAFoCgAwAEAAAAAQAADwCiDgAFAAAAAQAAAsSiDwAFAAAAAQAAAsyiEAADAAAAAQACAACkAQADAAAAAQAAAACkAgADAAAAAQAAAACkAwADAAAAAQAAAACkBgADAAAAAQAAAACkMQACAAAADQAAAtSkMgAFAAAABAAAAuKkNAACAAAACQAAAwKkNQACAAAACwAAAwwAAAAAAAAAAQAAAMgAMmZHAAf/+zIwMjU6MDU6MDYgMTU6MDY6MTUAMjAyNTowNTowNiAxNTowNjoxNQAAAAA9AAAACAAAACsAAAAIAAAAAQAAAAMAALjbAAApLAAAAMAAAAABABd2KQAAAYYAB7dPAAAAgDAyODAyMTAxNDE0OQAAAAAARgAAAAEAAAEsAAAAAQAAAAAAAAABAAAAAAAAAAE3MC0zMDBtbQAAMDAwMDAwMDAwMAAAAAD/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q=="

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempFile(name: string, contents: Uint8Array | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "media-ingester-exif-"))
  tempDirs.push(dir)
  const path = join(dir, name)
  await Bun.write(path, contents)
  return path
}

test("extractExif returns JSON-safe embedded EXIF fields", async () => {
  const path = await tempFile("photo.jpg", Buffer.from(EXIF_JPEG_BASE64, "base64"))

  const exif = await extractExif(path)

  expect(exif?.["Make"]).toBe("Canon")
  expect(exif?.["Model"]).toBe("Canon EOS 5D Mark III")
  expect(exif?.["ISO"]).toBe(800)
  expect(exif?.["LensInfo"]).toBe("70, 300, 0, 0")
  expect(String(exif?.["DateTimeOriginal"])).toMatch(/^2025-05-06T\d{2}:06:15\.000Z$/)
  expect(exif?.["ComponentsConfiguration"]).toBeUndefined()
})

test("extractExif returns null for corrupt files", async () => {
  const path = await tempFile("corrupt.jpg", "not an image")

  expect(await extractExif(path)).toBeNull()
})
