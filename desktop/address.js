// "Адрес сервера" window: shows the current address, saves a new one through the main process. On the very first
// start of a build with no server built in, it's the first thing the app shows.
const params = new URLSearchParams(location.search);
const input = document.getElementById('url');
const error = document.getElementById('error');
input.value = params.get('current') ?? '';
input.placeholder = params.get('placeholder') || input.placeholder;
if (params.get('first')) {
  document.getElementById('hint').textContent = 'Вставь адрес своего сервера Gomex.';
  document.getElementById('save').textContent = 'Открыть';
}
input.select();

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const problem = await window.gomexAddress.save(input.value.trim());
  if (problem) error.textContent = problem;
});
