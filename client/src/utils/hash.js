/** SHA-256 of a File/Blob as 0x-prefixed hex (matches the backend digest). */
export async function sha256Hex(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return (
    "0x" +
    [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

/** Read a File as a plain base64 string (no data: prefix) for uploads. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
