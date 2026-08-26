export const environment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyAIKBmwnZ5AYHBTHgvsdvWzCHbsdcvbVuo',
    authDomain: 'lol-bom-squad.firebaseapp.com',
    projectId: 'lol-bom-squad',
    storageBucket: 'lol-bom-squad.firebasestorage.app',
    messagingSenderId: '926798891647',
    appId: '1:926798891647:web:b499520b742954bce18d4a',
    measurementId: 'G-CM9J4ZZG1E'
  },
  functions: {
    region: 'europe-west1',
    // Optional override; by default URL is built from region + projectId.
    enrichPlayerUrl: ''
  }
};
