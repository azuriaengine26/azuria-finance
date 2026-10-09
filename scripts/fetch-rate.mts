// Fetches today's USD→HNL mid-market rate from Wise and prints the file the app reads.
// Run by .github/workflows/rates.yml:  node --experimental-strip-types scripts/fetch-rate.mts > usd-hnl.json
import { WISE_JSON_URL, WISE_PAGE_URL, WISE_PAGE_URL_ES, parseWiseJson, parseWisePage, rateToString } from '../src/core/fxsource.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
const attempts: [string, string, (t: string) => number | null][] = [
  ['json', WISE_JSON_URL, parseWiseJson],
  ['page', WISE_PAGE_URL, parseWisePage],
  ['page-es', WISE_PAGE_URL_ES, parseWisePage],
];

for (const [method, url, parse] of attempts) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: method === 'json' ? 'application/json' : 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } });
    const text = await res.text();
    if (!res.ok) { console.error(`${method}: HTTP ${res.status} ${text.slice(0, 160).replace(/\s+/g, ' ')}`); continue; }
    const v = parse(text);
    if (v == null) { console.error(`${method}: no rate found (${text.length} bytes, starts: ${text.slice(0, 160).replace(/\s+/g, ' ')})`); continue; }
    const out = { base: 'USD', quote: 'HNL', rate: rateToString(v), source: 'wise', method, fetched_at: new Date().toISOString(), url };
    console.error(`${method}: OK $1 = L${out.rate}`);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(0);
  } catch (e) {
    console.error(`${method}: ${(e as Error).message}`);
  }
}
console.error('Could not read the rate from Wise.');
process.exit(1);
