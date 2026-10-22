const host = new URLSearchParams(location.search).get('host') ?? '';
document.getElementById('host').textContent = host;

const button = document.getElementById('retry');
button.addEventListener('click', async () => {
  button.disabled = true;
  await window.atriumUnreachable.retry();
  // Still here: it didn't answer.
  button.disabled = false;
});
