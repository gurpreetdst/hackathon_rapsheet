import axios from 'axios';
import { Field, FieldUpdate } from './parser';

const API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GEMINI_API_KEY = 'AIzaSyAHMKFvxM8M5fRugNfhoBf-k7GFoXsQXdg';
const OPEN_API_KEY = '';

async function getResponseFromLocalhost(prompt: string) {
  try {
    // Make a request to Ollama server (assuming Ollama supports REST API)
    const ollamaResponse = await axios.post('http://localhost:11435/api/chat', {
      model: 'llama3.1',
      messages: [
        { role: 'system', content: 'You are a JSON output bot.' },
        {
          role: 'user',
          content: prompt,
        },
      ],
      stream: false,
    });

    // Send Ollama response back to client
    return ollamaResponse.data.message.content;
  } catch (error) {
    console.error('Error communicating with Ollama:', error);
    return [];
  }
}

async function getResponseFromOpenAI(input: string) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + OPEN_API_KEY,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      input: input,
      store: false,
    }),
  });

  const data = await response.json();
  console.log(data);
  const generatedText = data?.output[0].content[0].text || '[]';
  console.log(generatedText);
  return generatedText;
}

export async function getResponseFromGemini(input: string) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: input }],
        },
      ],
    }),
  });
  const data = await response.json();
  console.log('AI Response:', data);
  // Gemini response is text, we need to parse JSON inside it
  const generatedText =
    data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

  return generatedText;
}

export async function generateFormFromAI(formType: string): Promise<Field[]> {
  const promptTemplate = `
    Generate a JSON array of form fields for a "${formType}" form.
    Use this TypeScript schema:

    type Field = {
      id: string;
      label: string;
      type: 'text' | 'number' | 'date' | 'time' | 'datetime' | 'radio' | 'select' | 'email' | 'switch';
      options?: { id: string; label: string }[];
      pattern?: string;
      min?: number;
      max?: number;
      synonyms?: string[];
    };

    Validation rules to follow:
    - None of the fields should be "required".
    - If a field is an "email", do NOT add any validation pattern.
    - If a field is a "phone", enforce exactly 10 digits with a regex pattern: ^\\d{10}$.
    - If a field is "dob" (date of birth), it must be of type "date", never "string".
    - If a field has "start date" in its label or id, it must be of type "date", never "string".
    - For other fields, add realistic and meaningful patterns, min, or max where it makes sense (e.g., age 0–120, quantity >= 0).
    - IDs must be unique, lowercase_with_underscores.
    - Labels must be user-friendly.
    - Add sensible options for select/radio fields.
    - Respond with ONLY valid JSON (array of fields), no explanation, no markdown fences, no comments

  `;

  try {
    const generatedText = await getResponseFromLocalhost(promptTemplate);
    console.log(generatedText);
    // The model will output a clean JSON array
    const jsonString = generatedText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    console.log(jsonString);
    return JSON.parse(jsonString) as Field[];
  } catch (err) {
    console.error('Failed to parse AI response:', err);
    return [];
  }
}

const getFormattedData = async (
  fieldsArray: Field[],
  paragraphString: String,
) => {
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
Skip fields for which you cannot find any relevant information in the paragraph.
You must output a valid JSON array of FieldUpdate objects.
Avoid adding comments in the JSON output.
Don't include 0 confidence or null response
For field type like 'select' map the answers to the option's id of the field and value should be the option's id
Don't answer with any field that were not part of the field map given in input
Don't duplicate the answers and in case of multiple reponses use the last one given in user input
Do not include any text before or after the JSON.
Do not add explanations.
Return only the JSON array.
`;
  try {
    console.log(promptTemplate);
    const generatedText = await getResponseFromLocalhost(promptTemplate);

    console.log('Generated Text:', generatedText);

    // The model will output a clean JSON array
    const jsonString = generatedText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return null;
  }
};

export const remoteParser = async (
  schema: Array<Field>,
  userInput: String,
): Promise<FieldUpdate[]> => {
  const result = await getFormattedData(schema, userInput);
  if (result) {
    console.log('Mapped Data:', result);
    return result;
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
  return [];
};
