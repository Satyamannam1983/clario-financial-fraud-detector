const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

function available() {
  return Boolean(process.env.MISTRAL_API_KEY);
}

async function completeJson(system, user, fallback) {
  if (!available()) return { ...fallback, source: 'fallback' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(MISTRAL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) }
        ]
      })
    });
    if (!response.ok) throw new Error(`Mistral unavailable (${response.status})`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('Mistral returned no content');
    return { ...fallback, ...JSON.parse(content), source: 'mistral' };
  } catch (error) {
    return { ...fallback, source: 'fallback', fallback_reason: error.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { available, completeJson };
