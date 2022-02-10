require("dotenv").config('.env');
const { default: axios } = require("axios");
const mongoose = require("mongoose");
const NFTAttributeModel = require("./model/nftAttribute");
const cliProgress = require("cli-progress");
const Util = require("./src/util");
const log4js = require("log4js");
log4js.configure({
  appenders: {
    attributeFetcher: { type: "file", filename: "logs/attribute-fetcher.log" },
  },
  categories: { default: { appenders: ["attributeFetcher"], level: "error" } },
});
const {
  SKIP_TOKEN_FETCH_EXISTING_COLLECTION,
  SKIP_ATTRIBUTE_FETCH,
  SKIP_TOKEN_FETCH,
} = process.env;

const settings = {
  skipTokenFetch: SKIP_TOKEN_FETCH == 1,
  skipAttributeFetch: SKIP_ATTRIBUTE_FETCH == 1,
  skipTokenFetchExistingCollection: SKIP_TOKEN_FETCH_EXISTING_COLLECTION == 1,
};

class TokenFetcher {
  constructor(db, collectionId) {
    this.totalRecords = 0;
    this.fetchedCount = 0;
    this.barProgress = 0;
    this.db = db;
    this.endPointIndex = 0;
    this.collectionId = collectionId;
    this.bar = new cliProgress.SingleBar({
      format: `[{bar}] {percentage}% | {value}/{total} | {message}`,
    });
  }

  async _initProgress() {
    await this.fetch(0, 1);
    this.bar.start(this.totalRecords, 0, {
      message: `Fetching and saving tokens for collection: ${this.collectionId}`,
    });
  }

  async fetch(from = 0, count = 0) {
    const collectionId = this.collectionId;
    return axios
      .post(`${process.env.API_ADDRESS}/nftitems/fetchTokens`, {
        collectionAddresses: [collectionId],
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
          contractAddress: collectionId,
          tokenURI: token.tokenURI,
          tokenID: token.tokenID,
        }));
      })
      .catch(console.log);
  }

  async _isCollectionRecordExists() {
    const hasAnyRecords = await NFTAttributeModel.exists({
      contractAddress: this.collectionId,
    });
    return hasAnyRecords;
  }

  async fetchAllAndSave() {
    const anyCollectionRecordExists = await this._isCollectionRecordExists();
    if (
      settings.skipTokenFetchExistingCollection &&
      anyCollectionRecordExists
    ) {
      return Promise.resolve();
    }

    await this._initProgress();
    do {
      const tokens = await this.fetch(this.fetchedCount);
      this.fetchedCount += tokens.length;
      const tokenDBOperations = tokens.map((token) => {
        return NFTAttributeModel.findOneAndUpdate(
          {
            _nftItemId: token._nftItemId,
            contractAddress: token.contractAddress,
          },
          { $setOnInsert: token },
          { upsert: true }
        ).exec();
      });

      await Promise.all(tokenDBOperations);
      this.bar.increment(tokenDBOperations.length, this.barProgress, {
        message: `Fetched ${tokenDBOperations.length} tokens of collection: ${this.collectionId}`,
      });
    } while (this.fetchedCount < this.totalRecords);
    this.bar.update(this.bar.getTotal(), {
      message: `Tokens fetched and saved for the collection: ${this.collectionId}`,
    });
    this.bar.stop();
  }
}

class AttributeFetcher {
  static ENDPOINTS = [
    "https://openzoo.mypinata.cloud/ipfs/",
    "https://openzoo2.mypinata.cloud/ipfs/",
    "https://openzoo3.mypinata.cloud/ipfs/",
  ];

  constructor(db) {
    this.db = db;
    this.bar = new cliProgress.SingleBar({
      format: "[{bar}] {percentage}% | {value}/{total} | Fetched URL: {url}",
    });
    this.barProgress = 0;
    this.logger = log4js.getLogger("attributeFetcher");
  }

  static FILTER_EMPTY_ATTRIBUTES = {
    attributes: [],
    isRemoteHasAttributes: true,
  };

  async _getTotalEmptyRecordCount() {
    const result = await NFTAttributeModel.countDocuments(
      AttributeFetcher.FILTER_EMPTY_ATTRIBUTES
    ).exec();
    return result;
  }

  async _getRecordsWithoutAttributes(lastId = null, pageSize = 1000) {
    const filter = { ...AttributeFetcher.FILTER_EMPTY_ATTRIBUTES };

    if (lastId) {
      filter._id = { $gt: lastId };
    }

    return NFTAttributeModel.find(
      filter,
      "_id _nftItemId contractAddress tokenURI"
    )
      .limit(pageSize)
      .sort({ _id: 1 })
      .exec();
  }

  async _save(_nftItemId, contractAddress, data = null) {
    return NFTAttributeModel.findOneAndUpdate(
      {
        _nftItemId,
        contractAddress,
      },
      {
        attributes: data.attributes ?? [],
        ipfsRecord: Object.keys(data)
          .filter((key) => key !== "attributes")
          .reduce((acc, key) => {
            acc[key] = data[key];
            return acc;
          }, {}),
        isRemoteHasAttributes: "attributes" in data,
        errorCode: 0,
        errorMessage: null,
        updatedAt: Date.now(),
      }
    );
  }

  async _saveError(_nftItemId, contractAddress, errorCode, errorMessage) {
    return NFTAttributeModel.findOneAndUpdate(
      {
        _nftItemId,
        contractAddress,
      },
      {
        errorCode,
        errorMessage,
        updatedAt: Date.now(),
      }
    );
  }

  async fetch(record, previousEndpointIndex = -1) {
    const { _nftItemId, contractAddress, tokenURI } = record;

    const endPointIndex = Util.randomInt(
      0,
      AttributeFetcher.ENDPOINTS.length - 1,
      previousEndpointIndex
    );

    const endpoint = AttributeFetcher.ENDPOINTS[endPointIndex];
    let isEndpointChanged = true;
    let apiURL = "";
    if (tokenURI.includes("ipfs://")) {
      let uri = tokenURI.split("ipfs://")[1].replace(/([^:]\/)\/+/g, "$1");
      apiURL = `${endpoint}${uri}`;
    } else if (
      ["pinata.cloud", "cloudflare", "ipfs.io", "ipfs.infura.io"].some((x) =>
        tokenURI.includes(x)
      )
    ) {
      let uri = tokenURI.split("/ipfs/")[1];
      apiURL = `${endpoint}${uri}`;
    } else {
      isEndpointChanged = false;
      apiURL = tokenURI;
    }

    try {
      const response = await axios.get(apiURL, { timeout: 5000 });

      await this._save(_nftItemId, contractAddress, response.data);

      this.bar.increment(1, { url: apiURL });
      return Promise.resolve();
    } catch (error) {
      if (error.response?.status === 404) {
        await this._saveError(
          _nftItemId,
          contractAddress,
          error.response.status,
          `${apiURL}\n ${JSON.stringify(error)}`
        );
        return Promise.resolve();
      }

      // Too many requests or timeouts
      if (
        isEndpointChanged &&
        (error.response?.status === 429 ||
          (error.code ?? "") === "ECONNABORTED")
      ) {
        await Util.sleep(3600);
        return this.fetch(record, endPointIndex);
      } else {
        await this._saveError(
          _nftItemId,
          contractAddress,
          error.response?.status,
          `requestURL: ${apiURL} \n ${JSON.stringify(error)}`
        );
        return Promise.resolve();
      }
    }
  }

  async fetchAllAndSave() {
    const recordCount = await this._getTotalEmptyRecordCount();
    this.bar.start(recordCount, 0);

    let records = [];
    let lastId = null;
    let fetched = 0;

    do {
      records = await this._getRecordsWithoutAttributes(lastId);
      lastId = records[records.length - 1]?._id;
      fetched += records.length;

      const chunks = Util.chunkArray(records, process.env.ASYNC_CHUNK_COUNT);

      for (let i = 0; i < chunks.length; i++) {
        const tasks = chunks[i].map((record) => this.fetch(record));
        await Promise.all(tasks);
      }
    } while (fetched < recordCount);

    this.bar.stop();
  }
}

class CollectionService {
  constructor() {}

  async getIds() {
    const data = await axios
      .get(`${process.env.API_ADDRESS}/collection/fetchAllCollections`)
      .then((res) => res.data.data.map((x) => x.erc721Address));

    return data;
  }
}

(async () => {
  const db = await mongoose.connect(process.env.DB_CONNECTION_STRING);
  console.log(settings);

  if (!settings.skipTokenFetch) {
    const collectionIds = await new CollectionService().getIds();
    for (const collectionId of collectionIds) {
      await new TokenFetcher(db, collectionId).fetchAllAndSave();
    }
  }

  if (!settings.skipAttributeFetch) {
    console.log(`Fetching attributes...`);
    await new AttributeFetcher(db).fetchAllAndSave();
    console.log(`Fetching attributes has completed!`);
  }

  await db.disconnect();
  process.exit(0);
})();
