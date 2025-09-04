import axios from 'axios';
import { Field, FieldUpdate } from './parser';

const API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GEMINI_API_KEY = 'AIzaSyDSODlSNKIJVDAjPRibPDvo4vUSClGTUQM';
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
  return [];
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
    const generatedText = await getResponseFromGemini(promptTemplate);
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

**Expected Output Instructions:**
Your job is to parse only the provided paragraph and extract information that matches the given fields.
- Add a talkback text as well at end of the array as an object which I can give to text to speech engine to read out the values back to user, mapped to fieldId 'talkback_text'
- For each piece of information you can clearly identify, return a 'FieldUpdate' object.  
- If you cannot find a value for a field, do **not include that field** in the output.  
- Do not include 'null', empty strings, zero confidence, or placeholder values.  
- Only return updates for fields that are **explicitly mentioned in the paragraph**.  
- Do not attempt to guess or fill in missing values.  
- For 'select' fields, the 'value' must be the matching option's 'id'.  
- If a field is mentioned multiple times, only keep the **last occurrence**.  
- Do not output any fields other than those found in the text.  
- Your output must be a valid JSON array of 'FieldUpdate' objects.  
- Return only the JSON, with no extra text, comments, or explanation.  
- Output a single JSON array of \`FieldUpdate\` objects. Do not include any other text or explanation.
- Skip fields for which you cannot find any relevant information in the paragraph.
- You must output a valid JSON array of FieldUpdate objects.
- Avoid adding comments in the JSON output.
- Don't add comments in the response in the JSON output.
- Don't duplicate fieldIds; each fieldId should appear only once in the output. You can use the one that appears last in the user input.
- For fields of type "select", "radio", or "checkbox", response for the value should be one of the option's id.
- Do not include any text before or after the JSON.
- Do not add explanations.
`;

  try {
    console.log(promptTemplate);
    const generatedText = await getResponseFromGemini(promptTemplate);

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
