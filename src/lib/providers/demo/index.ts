/**
 * Winback AI — Demo Fallback Providers
 * Used when real API keys are unavailable. Always labelled as demo_fallback.
 */

import { Translator } from '../interfaces';
import { TranslationInput, TranslationResult } from '@/types';

export { DemoCampaignPlanner } from './planner';

const DEMO_TRANSLATIONS: Record<string, string> = {
  hi: '[DEMO] नमस्ते {name}! हम आपको याद करते हैं। वापस आएं और विशेष ऑफर का लाभ उठाएं!',
  ta: '[DEMO] வணக்கம் {name}! நாங்கள் உங்களை நினைவு கூருகிறோம். திரும்பி வாருங்கள்!',
  te: '[DEMO] నమస్కారం {name}! మీరు తిరిగి వచ్చి ప్రత్యేక ఆఫర్ పొందండి!',
  ml: '[DEMO] നമസ്കാരം {name}! ഞങ്ങൾ നിങ്ങളെ ഓർക്കുന്നു. തിരിച്ചു വരൂ!',
  bn: '[DEMO] হ্যালো {name}! আমরা আপনাকে মিস করছি। ফিরে আসুন এবং বিশেষ অফার পান!',
  gu: '[DEMO] નમસ્તે {name}! અમે તમને યાદ કરીએ છીએ. પાછા આવો અને વિશેષ ઓફર માણો!',
  mr: '[DEMO] नमस्कार {name}! आम्हाला तुमची आठवण येते. परत या आणि विशेष ऑफर मिळवा!',
  kn: '[DEMO] ನಮಸ್ಕಾರ {name}! ನಿಮ್ಮನ್ನು ನಾವು ನೆನಪಿಸಿಕೊಳ್ಳುತ್ತೇವೆ. ಮರಳಿ ಬನ್ನಿ!',
  pa: '[DEMO] ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ {name}! ਅਸੀਂ ਤੁਹਾਨੂੰ ਯਾਦ ਕਰਦੇ ਹਾਂ। ਵਾਪਸ ਆਓ!',
};

export class DemoTranslator implements Translator {
  async translate(input: TranslationInput): Promise<TranslationResult> {
    const translation = DEMO_TRANSLATIONS[input.target_language];

    if (!translation) {
      return {
        original: input.text,
        translated: '',
        source: 'demo_fallback',
        status: 'failed',
        error: `Language '${input.target_language}' is not supported in demo mode.`,
      };
    }

    return {
      original: input.text,
      translated: translation,
      source: 'demo_fallback',
      status: 'fallback',
    };
  }
}
