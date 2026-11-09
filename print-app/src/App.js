// App.js
import PrintForm from "./components/PrintForm/index";
import { LanguageProvider } from "./i18n";

export default function App() {
  return (
    <LanguageProvider>
      <PrintForm />
    </LanguageProvider>
  );
}
