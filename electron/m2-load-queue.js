const CONCURRENCY = 3;
let active = 0;
const queue = [];

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift();
    active++;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}

function runM2Load(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

module.exports = { runM2Load };
