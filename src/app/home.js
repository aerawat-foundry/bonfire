import { emberCode } from '../core/name.js';
import { emberPath, rememberName } from './site.js';
import './pwa.js'; // service worker

const form = document.getElementById('name-form');
const input = document.getElementById('name');
const error = document.getElementById('error');

input.focus();
form.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    const code = emberCode(input.value);
    rememberName(code, input.value);
    location.assign(emberPath(code));
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    input.focus();
  }
});
input.addEventListener('input', () => {
  error.hidden = true;
});
