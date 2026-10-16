// Asks tools/design-diff/android/capture-server.mjs for the hierarchy of the screen the screenshot
// just showed. Never fails the flow: a design capture must not break the journey it measures.
try {
  var res = http.post('http://127.0.0.1:4192/capture', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: SHOT, appId: APP_ID }),
  });
  if (!res.ok) console.log('design-capture: hierarchy not written for ' + SHOT + ': ' + res.body);
} catch (e) {
  console.log('design-capture: hierarchy not written for ' + SHOT + ': ' + e);
}
