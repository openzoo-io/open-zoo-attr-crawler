const nftAttribute = require("./model/nftAttribute");

Array.prototype.max = function () {
  return Math.max.apply(null, this);
};

Array.prototype.min = function () {
  return Math.min.apply(null, this);
};

Array.prototype.groupBy = function (key) {
  return this.reduce(function (rv, x) {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
};

function isNumeric(value) {
  return /^-?\d+$/.test(value);
}

(async () => {
  let results = await nftAttribute
    .find({
      collectionAddress: "0x992e4447f470ea47819d677b84d2459677bfdadf",
    })
    .select({ attributes: 1, _id: 0 })
    .exec();

  results = results
    .map((result) => result.attributes)
    .flat()
    .groupBy("trait_type");
  // results = groupBy(results, "trait_type");

  Object.keys(results).forEach((key) => {
    const values = results[key].map((x) => x.value);
    if (!values.every(isNumeric)) results[key] = results[key].groupBy("value");
    else {
      results[key] = { min: values.min(), max: values.max() };
    }
  });

  const filterData = { ranges: [], selects: [] };
  Object.entries(results).forEach(([key, value]) => {
    if ("min" in value && "max" in value)
      filterData.ranges.push({ key, ...value });
    else
      filterData.selects.push({
        key,
        value: Object.entries(value).map(([k, v]) => ({
          key: k,
          count: v.length,
        })),
      });
  });

  console.log(JSON.stringify(filterData));
})();
