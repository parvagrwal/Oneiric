/** True when this browser can create a WebGL context. Adding #no3d to the address turns the 3D view off for testing. */
export function webglAvailable(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.location.hash.includes('no3d')) return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
