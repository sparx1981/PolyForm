
export async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries: number = 3, initialDelay: number = 500) {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`Fetch failed with status: ${response.status}`);
      }
      return response;
    } catch (err) {
      lastError = err;
      const delay = initialDelay * Math.pow(2, i);
      console.warn(`[RETRY] Fetch failed (attempt ${i + 1}/${maxRetries}). Retrying in ${delay}ms...`, err);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}
