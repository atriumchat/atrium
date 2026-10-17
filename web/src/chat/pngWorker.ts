// Turns a picture into a PNG, away from the page: decoding and re-encoding a big one takes long enough to make
// the chat stutter if it ran on the main thread. See imageCopy.ts.
self.addEventListener('message', async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    postMessage({ id, png: await canvas.convertToBlob({ type: 'image/png' }) });
  } catch (error) {
    postMessage({ id, error: String(error) });
  }
});
