import { SYSTEM_PROMPT } from '../constants.js';

const API_URL   = '/api/claude';
const API_MODEL = 'claude-sonnet-4-5';

// ─── Toggle to avoid API calls during visual development ──────────────────────
const MOCK_MODE = false;

const MOCK_RESPONSES = {
  happy:       { key:'C',  title:'sunny afternoon',   summary:'A bright, bouncy progression that feels like warm sunlight.',         progression:[{chord:'C',   function:'I',   feel:'bright, open',     ukulele:[0,0,0,3]},{chord:'G',   function:'V',   feel:'lift, momentum',   ukulele:[0,2,3,2]},{chord:'Am',  function:'vi',  feel:'bittersweet dip',  ukulele:[2,0,0,0]},{chord:'F',   function:'IV',  feel:'warm resolve',     ukulele:[2,0,1,0]}]},
  melancholic: { key:'Am', title:'quiet november',    summary:'A slow, introspective loop that sits with the feeling.',              progression:[{chord:'Am',  function:'i',   feel:'somber, open',     ukulele:[2,0,0,0]},{chord:'G',   function:'VII', feel:'hopeful drift',    ukulele:[0,2,3,2]},{chord:'F',   function:'VI',  feel:'tender weight',    ukulele:[2,0,1,0]},{chord:'E',   function:'V',   feel:'unresolved pull',  ukulele:[1,4,0,2]}]},
  romantic:    { key:'F',  title:'candlelight',       summary:'Warm and close, like a slow dance in a small room.',                  progression:[{chord:'F',   function:'I',   feel:'warm embrace',     ukulele:[2,0,1,0]},{chord:'Dm',  function:'vi',  feel:'longing',          ukulele:[2,2,1,0]},{chord:'Bb',  function:'IV',  feel:'lush, full',       ukulele:[3,2,1,1]},{chord:'C',   function:'V',   feel:'gentle tension',   ukulele:[0,0,0,3]}]},
  mysterious:  { key:'Dm', title:'between the notes', summary:'Ambiguous and hovering, never quite resolving.',                      progression:[{chord:'Dm',  function:'i',   feel:'dark, searching',  ukulele:[2,2,1,0]},{chord:'Bb',  function:'VI',  feel:'shadowed warmth',  ukulele:[3,2,1,1]},{chord:'C',   function:'VII', feel:'unsettled lift',   ukulele:[0,0,0,3]},{chord:'A',   function:'V',   feel:'sharp tension',    ukulele:[2,1,0,0]}]},
  angry:       { key:'Em', title:'red static',        summary:'Driven and tense, lots of forward momentum.',                         progression:[{chord:'Em',  function:'i',   feel:'tense, coiled',    ukulele:[0,4,3,2]},{chord:'D',   function:'VII', feel:'heavy push',       ukulele:[2,2,2,0]},{chord:'C',   function:'VI',  feel:'momentary air',    ukulele:[0,0,0,3]},{chord:'B7',  function:'V',   feel:'sharp resolve',    ukulele:[1,2,2,2]}]},
  hopeful:     { key:'G',  title:'first light',       summary:'Rising and open, like something about to begin.',                     progression:[{chord:'G',   function:'I',   feel:'grounded lift',    ukulele:[0,2,3,2]},{chord:'D',   function:'V',   feel:'forward motion',   ukulele:[2,2,2,0]},{chord:'Em',  function:'vi',  feel:'reflective pause', ukulele:[0,4,3,2]},{chord:'C',   function:'IV',  feel:'open warmth',      ukulele:[0,0,0,3]}]},
  nostalgic:   { key:'D',  title:'old photographs',   summary:'A gentle ache, familiar and slightly out of reach.',                  progression:[{chord:'D',   function:'I',   feel:'warm, familiar',   ukulele:[2,2,2,0]},{chord:'A',   function:'V',   feel:'reaching back',    ukulele:[2,1,0,0]},{chord:'Bm',  function:'vi',  feel:'tender sadness',   ukulele:[4,2,2,2]},{chord:'G',   function:'IV',  feel:'soft resolve',     ukulele:[0,2,3,2]}]},
  dreamy:      { key:'C',  title:'half asleep',       summary:'Floating and blurred at the edges, soft landing.',                    progression:[{chord:'Cmaj7',function:'I',  feel:'hazy warmth',      ukulele:[0,0,0,2]},{chord:'Am7', function:'vi',  feel:'soft drift',       ukulele:[0,0,0,0]},{chord:'Fmaj7',function:'IV', feel:'suspended',        ukulele:[2,0,1,0]},{chord:'G',   function:'V',   feel:'gentle return',    ukulele:[0,2,3,2]}]},
};

export async function composeProgression(vibeProfile) {
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 800));
    return MOCK_RESPONSES[vibeProfile.mood] || MOCK_RESPONSES.melancholic;
  }

  const response = await fetch(API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      API_MODEL,
      max_tokens: 1000,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: JSON.stringify(vibeProfile) }],
    }),
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);

  const data  = await response.json();
  const text  = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}
