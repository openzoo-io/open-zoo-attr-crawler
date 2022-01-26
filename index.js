require("dotenv").config();
const cli = require("cli"),
  options = cli.parse({
    collectionAddress: [
      "c",
      "Collection Address",
      "string",
      process.env.COLLECTION_ADDRESS,
    ],
  });

const { default: axios } = require("axios");
const mongoose = require("mongoose");
const NFTAttributeModel = require("./model/nftAttribute");
const cliProgress = require("cli-progress");

const COLLECTION_ADDRESS =
  options.collectionAddress || process.env.COLLECTION_ADDRESS;

function chunkArray(arr, chunkSize) {
  var arrays = [];

  while (arr.length > 0) arrays.push(arr.splice(0, chunkSize));

  return arrays;
}

function randomInt(min, max, exclude = -1) {
  var num = Math.floor(Math.random() * (max - min + 1)) + min;
  return exclude > -1 && num === exclude ? randomInt(min, max, exclude) : num;
}

class TokenFetcher {
  constructor(db) {
    this.totalRecords = 0;
    this.fetchedCount = 0;
    this.barProgress = 0;
    this.db = db;
    this.bar = new cliProgress.SingleBar({});
    this.endPointIndex = 0;
  }

  async _initProgress() {
    await this.fetch(0, 1);
    this.bar.start(this.totalRecords, 0, { message: 0 });
  }

  async fetch(from = 0, count = 0) {
    return axios
      .post(`${process.env.API_ADDRESS}`, {
        collectionAddresses: [COLLECTION_ADDRESS],
        count: count || process.env.API_TOKEN_COUNT,
        from,
        sortby: "listedAt",
        isProfile: false,
        type: "all",
      })
      .then((response) => response.data.data)
      .then((response) => {
        this.totalRecords = this.totalRecords || response.total;
        return response.tokens.map((token) => ({
          _nftItemId: token._id,
          contractAddress: COLLECTION_ADDRESS,
          tokenURI: token.tokenURI,
          tokenID: token.tokenID,
        }));
      })
      .catch(console.log);
  }

  async fetchAllAndSave() {
    await this._initProgress();
    do {
      const tokens = await this.fetch(this.fetchedCount);
      this.fetchedCount += tokens.length;
      const tokenDBOperations = tokens.map((token) => {
        return NFTAttributeModel.findOneAndUpdate(
          {
            _nftItemId: token._nftItemId,
            contractAddress: token.contractAddress,
            tokenID: token.tokenID,
          },
          { $setOnInsert: token },
          { upsert: true }
        ).exec();
      });

      await Promise.all(tokenDBOperations);
      this.barProgress += tokenDBOperations.length;
      this.bar.update(this.barProgress);
    } while (this.fetchedCount < this.totalRecords);
    this.bar.stop();
  }
}

class AttributeFetcher {
  static ENDPOINTS = [
    "https://openzoo.mypinata.cloud",
    "https://openzoo2.mypinata.cloud",
    "https://openzoo3.mypinata.cloud",
    "https://gateway.pinata.cloud",
  ];

  constructor(db) {
    this.db = db;
    this.bar = new cliProgress.SingleBar({
      format: "[{bar}] {percentage}% | {value}/{total} | Fetched URL: {url}",
    });
    this.barProgress = 0;
  }

  async _getTotalEmptyRecordCount() {
    const result = await NFTAttributeModel.where("attributes")
      .equals([])
      .countDocuments()
      .exec();
    return result;
  }

  async _getRecordsWithoutAttributes() {
    const records = await NFTAttributeModel.where("attributes")
      .equals([])
      .select("_nftItemId contractAddress tokenURI")
      .exec();
    return records;
  }

  async fetch(record, previousEndpointIndex = -1) {
    const endPointIndex = randomInt(
      0,
      AttributeFetcher.ENDPOINTS.length - 1,
      previousEndpointIndex
    );
    const endpoint = AttributeFetcher.ENDPOINTS[endPointIndex];
    const apiURL = record.tokenURI.replace(
      "https://openzoo.mypinata.cloud",
      endpoint
    );

    try {
      const response = await axios.get(apiURL, { timeout: 5000 });
      await NFTAttributeModel.findOneAndUpdate(
        {
          _nftItemId: record._nftItemId,
          contractAddress: record.contractAddress,
        },
        { $set: response.data }
      );
      this.bar.update(++this.barProgress, { url: apiURL });
      return Promise.resolve();
    } catch (error) {
      return this.fetch(record, endPointIndex);
    }
  }

  async fetchAllAndSave() {
    const recordCount = await this._getTotalEmptyRecordCount();
    this.bar.start(recordCount, 0);

    const records = await this._getRecordsWithoutAttributes();
    const chunks = chunkArray(records, process.env.ASYNC_CHUNK_COUNT);
    for (let i = 0; i < chunks.length; i++) {
      const tasks = chunks[i].map((record) => this.fetch(record));
      await Promise.all(tasks);
    }

    this.bar.stop();
  }
}

(async () => {
  const db = await mongoose.connect(process.env.DB_CONNECTION_STRING);
  const tokenFetcher = new TokenFetcher(db);
  const attributeFetcher = new AttributeFetcher(db);

  console.log(`Fetching tokens....`);
  await tokenFetcher.fetchAllAndSave();
  console.log(`Fetching tokens has completed. Fetching attributes...`);
  await attributeFetcher.fetchAllAndSave();
  console.log(
    `Fetching attributes has completed. Proccess completed successfully!`
  );

  await db.disconnect();
  process.exit(0);
})();
