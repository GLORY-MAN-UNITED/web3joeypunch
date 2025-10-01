const { ethers } = require("ethers");
require("dotenv").config();

const RPC_URL = process.env.SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.VOTE_TOKEN_ADDRESS;

// Minimal ABI for what we need
const abi = [
  "function mint(address to, uint256 amount) external",
  "function decimals() view returns (uint8)"
];

/**
 * Mint tokens to a specific wallet address
 * @param {string} toAddress - The wallet address to mint tokens to
 * @param {number} amount - The amount of tokens to mint (without decimals)
 * @returns {Promise<string>} - Transaction hash
 */
async function mintTokensToUser(toAddress, amount = 20) {
  try {
    if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
      throw new Error("Missing environment variables: RPC_URL, PRIVATE_KEY, or VOTE_TOKEN_ADDRESS");
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const token = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

    // Get decimals and calculate amount
    const decimals = await token.decimals();
    const mintAmount = ethers.parseUnits(amount.toString(), decimals);

    // Send mint transaction
    const tx = await token.mint(toAddress, mintAmount);
    console.log(`Minting ${amount} tokens to ${toAddress}, tx hash:`, tx.hash);
    
    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`Mint confirmed in block:`, receipt.blockNumber);
    
    return tx.hash;
  } catch (error) {
    console.error("Error minting tokens:", error);
    throw error;
  }
}

/**
 * Command-line interface function for minting (from original mint.js)
 * Mints 1000 tokens to a hardcoded test address
 */
async function mintCLI() {
  try {
    if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
      throw new Error("Missing env: RPC_URL, PRIVATE_KEY, VOTE_TOKEN_ADDRESS");
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const token = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

    const to = "0x7F72dDF0e619F9B1600D9B68979BD5a3F21C01E7";
    const decimals = await token.decimals();
    const amount = ethers.parseUnits("1000", decimals); // mint 1000 VOTE

    const tx = await token.mint(to, amount);
    console.log("Mint tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("Mint confirmed in block:", receipt.blockNumber);
    
    return tx.hash;
  } catch (error) {
    console.error("CLI minting error:", error);
    throw error;
  }
}

// If this file is run directly from command line, execute CLI function
if (require.main === module) {
  mintCLI().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { mintTokensToUser, mintCLI };