require("dotenv").config();
const ethers = require("ethers");
const mongoose = require("mongoose");
const NFTAttribute = require("../model/nftAttribute");

const Contracts = {
  888: {
    auction: "0x8930F0CAFdA831181Fd3f5dCCCAEb0418b615b56",
    sales: "0xF6BFd75B6255B073AE36b66b099fF90DF0C57e22",
    bundleSales: "0xc1e06346D910067b2261e43FCd4FA523e9877670",
    factory: "0x8a5537bf123d95d0908be54ED46551bD41b36db7", //FantomNFTFactory
    privateFactory: "0xB3E21271194b2F6F6DA79E676e1fBC8aa088Bcfb", //FantomNFTFactoryPrivate
    artFactory: "0xa91D2825828BD40Ead230db7649F0bb8bAF894Cb", //FantomArtFactory
    privateArtFactory: "0x3e070bE392D6a54D4A9AF51d4A476f951aA3993B", //FantomArtFactoryPrivate
    zooBooster: "0x38034B2E6ae3fB7FEC5D895a9Ff3474bA0c283F6",
    zooElixir: "0xA67213608Db9D4BFFAc75baD01Ca5B1f4ad0724c",
    zooAlchemy: "0x23A9f34aa1e45f9E191A6615d24A781607a1bcb1",
    zooGenes: "0x992e4447f470ea47819d677b84d2459677bfdadf",
  },
  999: {
    auction: "0x7e408f989deD4ac3ce2AdddD96b8E518Cbdc9aa0",
    sales: "0x271b096921Fa5891D48CF2bF43F42fc32Fa69fDf",
    bundleSales: "0x23fcfcE2ec048f3e78d2c8EFfE598F81B0330C3c",
    factory: "0x94e75dD5194b4Cd800fF8DB232dE2500ee3E785f", //FantomNFTFactory
    privateFactory: "0xB628A26232F5E24B771D268C8680877DA9e8D209", //FantomNFTFactoryPrivate
    artFactory: "0x01C619F89247284268DA8837ffEE8fBb5a78eA22", //FantomArtFactory
    privateArtFactory: "0xCaa6ff4Db9a762dcdc725D69DD5d9B392A66d933", //FantomArtFactoryPrivate
    zooBooster: "0xbCF9F4fae90dA7c4BB05DA6f9E9A9A39dc5Ce979",
    zooElixir: "0xDe3f8DA0Cf18b4ddc5e2f3d94ca3694c241507Bd",
    zooAlchemy: "0x910A1a6b133A6A869141722872Eb19609A16B511",
    zooGenes: "0x35b0b5c350b62ddee9be102b7567c4dabe52cf4f",
  },
};

const ALCHEMY_ABI = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "elixirInfoMap",
    outputs: [
      {
        internalType: "uint256",
        name: "level",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "drops",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "color",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "shape",
        type: "uint256",
      },
      {
        internalType: "string",
        name: "name",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
    constant: true,
  },
];

const ZOOBOOSTER_ABI = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_tokenId",
        type: "uint256",
      },
    ],
    name: "getBoosting",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
    constant: true,
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_tokenId",
        type: "uint256",
      },
    ],
    name: "getLockTimeReduce",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
    constant: true,
  },
];

const CHAIN = Number(process.env.CHAIN);
const isMainnet = CHAIN === 888;

const getContract = async (address, abi) => {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    isMainnet
      ? "https://gwan-ssl.wandevs.org:56891"
      : "https://gwan-ssl.wandevs.org:46891",
    CHAIN
  );
  provider.pollingInterval = 10 * 1000;

  return new ethers.Contract(address, abi, provider);
};

const useZooBoosterContract = () => {
  const getZooBoosterContract = async () =>
    await getContract(Contracts[CHAIN].zooBooster, ZOOBOOSTER_ABI);

  const getBoosting = async (tokenId) => {
    const contract = await getZooBoosterContract();
    return await contract.getBoosting(tokenId);
  };

  const getLockTimeReduce = async (tokenId) => {
    const contract = await getZooBoosterContract();
    return await contract.getLockTimeReduce(tokenId);
  };

  return {
    getBoosting,
    getLockTimeReduce,
  };
};

const useZooElixirContract = () => {
  const getAlchemyContract = async () =>
    await getContract(Contracts[CHAIN].zooAlchemy, ALCHEMY_ABI);

  const getElixir = async (tokenId) => {
    const contract = await getAlchemyContract();
    return await contract.elixirInfoMap(tokenId);
  };

  return {
    getElixir,
  };
};
function getMethods(obj) {
  var res = [];
  for (var m in obj) {
    if (typeof obj[m] == "function") {
      res.push(m);
    }
  }
  return res;
}
(async () => {
  const db = await mongoose.connect(process.env.DB_CONNECTION_STRING);

  const getElixir = async (attribute) => {
    const keys = ALCHEMY_ABI[0].outputs.map((x) => x.name);
    const elixirResponse = await useZooElixirContract().getElixir(
      attribute.tokenID
    );

    const result = [];
    result.push(
      {
        trait_type: "level",
        value: elixirResponse["level"].toNumber(),
      },
      {
        trait_type: "drops",
        value: elixirResponse["drops"].toNumber(),
      },
      {
        trait_type: "color",
        value: elixirResponse["color"].toString(),
      },
      {
        trait_type: "shape",
        value: elixirResponse["shape"].toNumber(),
      },
      {
        trait_type: "name",
        value: elixirResponse["name"].toString(),
      }
    );

    return result;
  };

  const nftAttributes = await NFTAttribute.find({
    contractAddress: Contracts[CHAIN].zooElixir.toLowerCase(),
  }).exec();


//   for(const nftAttribute of nftAttributes) {

//     nftAttribute.

//   }

  const a = await getElixir(nftAttributes[0]);

  console.log(a);

  await db.disconnect();
})();
