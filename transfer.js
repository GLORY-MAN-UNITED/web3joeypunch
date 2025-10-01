import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.VOTE_TOKEN_ADDRESS;

if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  throw new Error("Missing env: RPC_URL, PRIVATE_KEY, VOTE_TOKEN_ADDRESS");
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Minimal ABI for what we need
const abi = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

async function main() {
  const token = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

  const to = "0x7F72dDF0e619F9B1600D9B68979BD5a3F21C01E7";
  const decimals = await token.decimals();
  const amount = ethers.parseUnits("1", decimals); // mint 1000 VOTE

  const tx = await token.transfer(to, amount);
  console.log("Transfer tx sent:", tx.hash);
  const rcpt = await tx.wait();
  console.log("Transfer confirmed in block:", rcpt.blockNumber);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});