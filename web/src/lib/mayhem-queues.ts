// The queues ARAM: Mayhem is played in. The importer builds the same list from Riot's official queue file
// (data/constants/queues.json: every queue whose description mentions Mayhem) plus 2450, which serves Mayhem
// games but isn't on the list yet; see mayhem_queue_ids() in importer/mayhem_import.py. The site's API runs on
// Cloudflare without the repo's data files, so the ids are written here once, and tests/unit/mayhem-queues.test.ts
// checks the two lists still agree.
export const MAYHEM_QUEUE_IDS: readonly number[] = [2400, 2450];

/** Whether a game's queue id (as a number or a string) is one of the Mayhem queues. */
export const isMayhemQueue = (queue: unknown) => MAYHEM_QUEUE_IDS.includes(Number(queue));
