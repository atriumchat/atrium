import type { Facts } from './setup';

/**
 * How many people a server takes, said instead of its specs. A cautious guess from its cores and memory until the
 * LiveKit load test (BACKLOG.md, нагрузочный тест) gives measured numbers: voice is light, while a shared screen goes
 * out to every viewer separately. The server's link speed isn't known here, and a cheap host often caps it.
 */
export function capacity({ cores, memory }: Pick<Facts, 'cores' | 'memory'>) {
  const tight = memory < 1.5;
  return {
    call: Math.min(cores * 20, tight ? 12 : 60),
    screen: Math.min(cores * 8, tight ? 6 : 30),
  };
}
