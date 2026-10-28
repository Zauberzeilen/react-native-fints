import { useState } from 'react';
import { Button, ScrollView, Text, TextInput } from 'react-native';
import { FinTSClient } from 'react-native-fints';

/**
 * Minimal manual test screen: enter bank URL + credentials, list accounts
 * and balances. PIN stays in component state (memory) only.
 */
export default function App() {
  const [bankUrl, setBankUrl] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [output, setOutput] = useState('');

  async function load() {
    try {
      const client = new FinTSClient({ bankUrl, bankCode, userId, fetchFn: fetch as never });
      client.setPin(pin);
      const accounts = await client.getAccounts();
      const lines = [];
      for (const acc of accounts) {
        const balance = await client.getBalance(acc);
        lines.push(`${acc.iban}: ${balance.amount.toFixed(2)} ${balance.currency}`);
      }
      client.clear();
      setPin('');
      setOutput(lines.join('\n') || 'No accounts');
    } catch (err) {
      setOutput(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
      <Text>FinTS manual test</Text>
      <TextInput placeholder="FinTS URL" value={bankUrl} onChangeText={setBankUrl} autoCapitalize="none" />
      <TextInput placeholder="Bank code (BLZ)" value={bankCode} onChangeText={setBankCode} />
      <TextInput placeholder="User ID" value={userId} onChangeText={setUserId} autoCapitalize="none" />
      <TextInput placeholder="PIN" value={pin} onChangeText={setPin} secureTextEntry />
      <Button title="Load accounts" onPress={load} />
      <Text>{output}</Text>
    </ScrollView>
  );
}
