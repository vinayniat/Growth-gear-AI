const admin = require('firebase-admin');

let adminInitialized = false;

// Initialize Firebase Admin SDK ONLY when a real service account key is provided.
// Without it, firebase-admin cannot verify tokens in a cloud environment.
const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

if (serviceAccountVar) {
    try {
          let serviceAccount;
          try {
                  serviceAccount = JSON.parse(serviceAccountVar);
          } catch (e) {
                  // Treat as a file path if JSON parse fails
            serviceAccount = require(serviceAccountVar);
          }
          admin.initializeApp({
                  credential: admin.credential.cert(serviceAccount)
          });
          console.log('Firebase Admin SDK initialized successfully via service account.');
          adminInitialized = true;
    } catch (err) {
          console.warn('Firebase Admin SDK initialization failed: %s. Will use HTTP fallback.', err.message);
    }
} else {
    console.warn(
          'FIREBASE_SERVICE_ACCOUNT_KEY is not set. ' +
          'Firebase Admin SDK will NOT be initialized. ' +
          'Token verification will use the Google Identity Toolkit HTTP API.'
        );
}

/**
 * Verify Firebase ID Token
 * @param {string} idToken
 * @returns {Promise<{uid: string, email: string, name?: string, avatar?: string}>}
 */
async function verifyFirebaseIdToken(idToken) {
    // Use Firebase Admin SDK when properly initialized with a service account
  if (adminInitialized) {
        try {
                const decodedToken = await admin.auth().verifyIdToken(idToken);
                return {
                          uid: decodedToken.uid,
                          email: decodedToken.email,
                          name: decodedToken.name,
                          avatar: decodedToken.picture
                };
        } catch (err) {
                console.warn(
                          'Firebase Admin verifyIdToken failed: %s. Falling back to HTTP API.',
                          err.message
                        );
                // Fall through to HTTP fallback
        }
  }

  // Fallback: use Google Identity Toolkit accounts:lookup API.
  // This checks that the token is valid and the user exists in Firebase Auth.
  const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) {
          throw new Error(
                  'Firebase verification failed: FIREBASE_SERVICE_ACCOUNT_KEY and FIREBASE_API_KEY are both missing. ' +
                  'Please set at least one of these environment variables in your deployment.'
                );
    }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;

  let response;
    try {
          response = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ idToken })
          });
    } catch (networkErr) {
          throw new Error(
                  'Network error contacting Google Identity Toolkit API: ' + networkErr.message
                );
    }

  const data = await response.json();

  if (!response.ok || !data.users || data.users.length === 0) {
        const errorMsg = data.error?.message || 'Invalid or expired Firebase ID token';
        throw new Error(errorMsg);
  }

  const user = data.users[0];
    return {
          uid: user.localId,
          email: user.email,
          name: user.displayName,
          avatar: user.photoUrl
    };
}

module.exports = {
    verifyFirebaseIdToken
};
