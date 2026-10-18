// The "Server address" window. On the very first start of a build with no server built in it is the whole app: two
// ways in (an invite from a friend, or setting up one's own server), then one field for the link or address. From
// the tray later it is just the field, to move the app to a new address.
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const input = $('url');
const error = $('error');
const first = Boolean(params.get('first'));
const placeholder = params.get('placeholder') || 'https://app.example.com';

function enter({ title, hint, hold, button, back }) {
  $('start').hidden = true;
  $('enter').hidden = false;
  $('title').textContent = title;
  $('hint').textContent = hint;
  $('hint').hidden = !hint;
  input.placeholder = hold;
  $('save').textContent = button;
  $('back').hidden = !back;
  error.textContent = '';
  input.focus();
}

if (first) {
  $('start').hidden = false;
} else {
  enter({ title: t('address.title'), hint: t('address.hint'), hold: placeholder, button: t('address.save'), back: false });
  input.value = params.get('current') ?? '';
  input.select();
}

$('invite').addEventListener('click', () => {
  // The whole invite link is welcome here: the app opens it, so sign-up comes with the invite already in place.
  enter({ title: t('address.inviteTitle'), hint: '', hold: `${placeholder}/?invite=…`, button: t('address.open'), back: true });
});

// One's own server is set up right from the app, in its own window.
$('own').addEventListener('click', () => window.gomexAddress.setup());

$('back').addEventListener('click', () => {
  $('enter').hidden = true;
  $('start').hidden = false;
  input.value = '';
});

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const problem = await window.gomexAddress.save(input.value.trim());
  if (problem) error.textContent = problem;
});
