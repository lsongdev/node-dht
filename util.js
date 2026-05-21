const crypto = require('crypto');

const randomID = (len = 20) => {
  return crypto.randomBytes(len);
}

const xorDistance = (a, b) => {
  if (Buffer.isBuffer(a)) a = Buffer.from(a);
  if (Buffer.isBuffer(b)) b = Buffer.from(b);
  if (a.length !== b.length) throw new Error('IDs must be equal length');
  const result = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

const compareDistance = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

module.exports = {
  randomID,
  xorDistance,
  compareDistance
};