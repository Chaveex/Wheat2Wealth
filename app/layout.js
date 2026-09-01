import './globals.css';

export const metadata = {
  title: 'Wheat2Wealth',
  description: 'Un idle game de ferme capitaliste — parcelles, blé, et un peu de spéculation.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
