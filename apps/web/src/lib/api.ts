import { healthResponseSchema } from '@kaaryasthan/shared';

export async function getApiHealth(): Promise<boolean> {
  try {
    const baseUrl = process.env.API_URL ?? 'http://localhost:4000';
    const response = await fetch(new URL('/api/v1/health', baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    return healthResponseSchema.safeParse(await response.json()).success;
  } catch {
    return false;
  }
}
