class Util {
  static chunkArray(arr, chunkSize) {
    const arrays = [];
    while (arr.length > 0) arrays.push(arr.splice(0, chunkSize));
    return arrays;
  }

  static randomInt(min, max, exclude = -1) {
    const num = Math.floor(Math.random() * (max - min + 1)) + min;
    return exclude > -1 && num === exclude
      ? Util.randomInt(min, max, exclude)
      : num;
  }

  static async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = Util;
