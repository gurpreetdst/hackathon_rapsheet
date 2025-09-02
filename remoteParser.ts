import { FieldUpdate } from "./parser";

const GEMINI_API_KEY = "AIzaSyCJDQTtJ-glf8PZAMxivLiGB70xK-psuds"
const callGeminiApi = async (fieldsArray, paragraphString) => {
  const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  
  const promptTemplate = `
You are a data parsing and mapping bot. Your task is to extract information from a given paragraph and map it to a provided array of fields.

The following are the field definitions and the required output format.

**Input Schema:**
\`\`\`typescript
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'radio'
  | 'select'
  | 'checkbox'
  | 'switch'
  | 'email'
  | 'phone';

export type Option = { id: string; label: string; synonyms?: string[] };

export type Field = {
  id: string;
  label: string;
  type: FieldType;
  options?: Option[];
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  synonyms?: string[];
};
\`\`\`

**Output Schema:**
\`\`\`typescript
export type FieldUpdate = {
  fieldId: string;
  value: any;
  confidence: number; // 0..1
  evidence?: string;
};
\`\`\`

**Instructions:**
Parse the paragraph below and, for each piece of information you find, create a \`FieldUpdate\` object. The \`fieldId\` should match the \`id\` from the corresponding field in the \`fields\` array. The \`value\` should be the extracted data. The \`confidence\` should be a number from 0 to 1 indicating how certain you are of the match, where 1 is absolute certainty. The \`evidence\` should be the exact substring from the paragraph that you used to determine the value.

**Fields to map:**
\`\`\`json
${JSON.stringify(fieldsArray, null, 2)}
\`\`\`

**Paragraph to parse:**
\`\`\`
${paragraphString}
\`\`\`

**Expected Output:**
Output a single JSON array of \`FieldUpdate\` objects. Do not include any other text or explanation.
`;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: promptTemplate }],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseData = await response.json();
    const generatedText = responseData.candidates[0].content.parts[0].text;
    
    // The model will output a clean JSON array
    const jsonString = generatedText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(jsonString);

  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return null;
  }
};

// Example Usage
const sampleFields = [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'dob', label: 'Date of Birth', type: 'date', synonyms: ['birthday'] },
  { id: 'email', label: 'Email', type: 'email' },
  { id: 'phone', label: 'Phone Number', type: 'phone', synonyms: ['contact'] },
];

const sampleParagraph = "My name is Jane Smith, I was born on 12/05/1990. My email is jane.smith@example.com and you can reach me at 555-123-4567.";

export const remoteParser = async (schema, userInput): Promise<FieldUpdate[]>  => {
  const result = await callGeminiApi(schema, userInput);
  if (result) {
    console.log("Mapped Data:", result);
    return result
    /*
      Example Expected Output:
      [
        { "fieldId": "name", "value": "Jane Smith", "confidence": 1.0, "evidence": "Jane Smith" },
        { "fieldId": "dob", "value": "12/05/1990", "confidence": 1.0, "evidence": "12/05/1990" },
        { "fieldId": "email", "value": "jane.smith@example.com", "confidence": 1.0, "evidence": "jane.smith@example.com" },
        { "fieldId": "phone", "value": "555-123-4567", "confidence": 1.0, "evidence": "555-123-4567" }
      ]
    */
  }
};