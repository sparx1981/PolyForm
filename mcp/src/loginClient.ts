import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

/** Browser side of the sign-in page: Google via the PolyForm Firebase project, then back to Claude. */
const page = document.getElementById('login')!;
const config = JSON.parse(page.dataset.firebase!);
const pending = page.dataset.pending!;
const button = document.getElementById('google') as HTMLButtonElement;
const status = document.getElementById('status')!;

const auth = getAuth(initializeApp(config));

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Signing in…';
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = await result.user.getIdToken();
    const response = await fetch('/authorize/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pending, idToken }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error_description || 'Sign-in was refused.');
    status.textContent = 'Signed in. Returning to Claude…';
    window.location.href = body.redirect;
  } catch (error) {
    status.textContent = (error as Error).message;
    button.disabled = false;
  }
});
