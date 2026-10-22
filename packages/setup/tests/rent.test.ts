import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readServerLetter } from '../src/index';

test("a host's letter gives the server's IP and root password", () => {
  const letter = `Здравствуйте!
Ваш сервер готов.
Доступ к панели: https://panel.example.com
Логин панели: me@mail.ru
Пароль панели: Panel-Secret1

IP-адрес: 185.22.14.7
Логин: root
Пароль: k9vRt2pQx
`;
  assert.deepEqual(readServerLetter(letter), { host: '185.22.14.7', user: 'root', password: 'k9vRt2pQx' });
});

test('pasted into a one-line field, without its line breaks', () => {
  const line = 'Your server is ready. IP address: 203.0.113.24 Username: root Password: Xy7#qLm2. Thanks!';
  assert.deepEqual(readServerLetter(line), { host: '203.0.113.24', user: 'root', password: 'Xy7#qLm2' });
});

test('private addresses and masks are not the server', () => {
  assert.equal(readServerLetter('Маска 255.255.255.0, шлюз 10.0.0.1, пароль: abc'), null);
  assert.deepEqual(readServerLetter('IP 10.0.0.5, внешний 91.200.1.2, root password - s3cret')?.host, '91.200.1.2');
});

test('no password, nothing to fill', () => {
  assert.equal(readServerLetter('IP: 91.200.1.2'), null);
  assert.equal(readServerLetter(''), null);
});
