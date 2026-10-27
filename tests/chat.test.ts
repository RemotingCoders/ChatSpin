import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChatQuestion } from '../server/chat.ts';

test('Ordinary questions are captured without commands and preserve their language', () => {
  for (const text of ['Who are you?', 'Who are you', 'What advice would you give a new streamer?', 'How do you avoid burnout', 'Can you recommend a camera', '¿Qué consejo darías?', 'Cómo empezaste a transmitir', 'Por qué elegiste Twitch', 'どんなカメラですか？', 'كيف بدأت؟', '@streamer What camera do you use?']) assert.equal(extractChatQuestion(text), text);
});

test('Explicit ask supports unpunctuated questions and remains backward compatible', () => {
  assert.equal(extractChatQuestion('!ask tell us about your streaming setup'), 'tell us about your streaming setup');
  assert.equal(extractChatQuestion(' !ASK   Who are you? '), 'Who are you?');
});

test('Normal chat, participant commands, empty content, and URL queries do not become questions', () => {
  for (const text of ['hello', 'great stream!', '!join', '!leave', '!help who are you?', '/me asks why?', '!ask', '???', 'https://example.com/search?q=stream', 'What a great stream', 'How nice to see you']) assert.equal(extractChatQuestion(text), null, text);
  assert.equal(extractChatQuestion('a'.repeat(501) + '?'), null);
  assert.equal(extractChatQuestion('!ask ' + 'a'.repeat(501)), null);
});
