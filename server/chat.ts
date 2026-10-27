const questionOpening = /^(?:(?:who|what|when|where|why|how|which|whose|whom)|(?:(?:do|does|did|is|are|was|were|can|could|would|should|will|have|has)\s+(?:i|you|we|they|he|she|it))|(?:qu[eé]|qui[eé]n(?:es)?|cu[aá]l(?:es)?|cu[aá]nt(?:o|a|os|as)|c[oó]mo|d[oó]nde|cu[aá]ndo|por\s+qu[eé]|para\s+qu[eé]))\s+\S/iu;

export function extractChatQuestion(message: string): string | null {
  const text = message.trim();
  const command = /^!ask(?:\s+|$)/iu.exec(text);
  const question = command ? text.slice(command[0].length).trim() : text;
  if (!question || question.length > 500 || !/[\p{L}\p{N}]/u.test(question)) return null;
  if (command) return question;
  if (/^[!/]/u.test(text)) return null;
  const content = text.replace(/https?:\/\/\S+/giu, '').replace(/^(?:@\S+\s+)+/u, '').trim();
  if (/[?¿？؟]/u.test(content)) return text;
  if (/^(?:what\s+an?|how\s+(?:nice|lovely|great|cool))\s/iu.test(content)) return null;
  return questionOpening.test(content) ? text : null;
}
