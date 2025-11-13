import "./globals.css";
export const metadata = {
  title: "Fantasy Waiver Tool",
  description: "Predictive player stat modeling with weather context",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gradient-to-br from-gray-900 via-gray-800 to-black text-gray-100 min-h-screen font-sans antialiased">
        <div className="max-w-6xl mx-auto p-6">{children}</div>
      </body>
    </html>
  );
}
