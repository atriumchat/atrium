/**
 * How many people a server takes, said instead of its specs. A cautious guess from its cores and memory (GB) until
 * the LiveKit load test gives measured numbers: voice is light, while a shared screen goes out to every viewer
 * separately. The server's link speed isn't known here, and a cheap host often caps it.
 */
export function capacity({ cores, memory }: { cores: number; memory: number }) {
  const tight = memory < 1.5;
  return {
    call: Math.min(cores * 20, tight ? 12 : 60),
    screen: Math.min(cores * 8, tight ? 6 : 30),
  };
}
