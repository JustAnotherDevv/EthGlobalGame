import axios, { AxiosError } from 'axios';

interface FaucetResponse {
  success?: boolean;
  message?: string;
  txHash?: string; 
}

async function requestTokens(address: string): Promise<void> {
  const url = 'https://clearnet-sandbox.yellow.com/faucet/requestTokens';
  
  const payload = {
    userAddress: address
  };

  try {
    const { data } = await axios.post<FaucetResponse>(url, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('Success! Faucet response:', data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<FaucetResponse>;
      console.error('API Error:', axiosError.response?.data || axiosError.message);
    } else {
      console.error('Unexpected Error:', error);
    }
  }
}

const targetAddress = '0x';
requestTokens(targetAddress);