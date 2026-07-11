import { render, Text } from 'ink';
const { unmount, waitUntilExit } = render(<Text color="green">HELLO-INK</Text>);
setTimeout(() => unmount(), 3000);
await waitUntilExit();
